# WebSocket Broadcast from External Agent Processes

> Design document for cross-process WebSocket broadcast after DB inserts in jim-human.ts and leo-human.ts

## Problem

`jim-human.ts` and `leo-human.ts` run as standalone Node processes, separate from the main
HAN server (`server.ts`). When they insert messages into `conversation_messages` via their
`postMessage()` functions, the admin UI doesn't update in real time because no WebSocket
broadcast occurs — `broadcast()` from `ws.ts` only exists in the server process.

The conversations route (`conversations.ts:293`) and supervisor worker
(`supervisor-worker.ts:1407`) both call `broadcast()` directly because they run inside the
server process. The external agents cannot.

## Options Evaluated

### Option 1: Signal File

Write a JSON file to `~/.han/signals/ws-broadcast`. The main server watches the signals
directory and calls `broadcast()` when it detects the file.

**Pros:**
- Consistent with existing architecture — jim-human, leo-human, jemma, and leo-heartbeat
  all use `~/.han/signals/` for cross-process communication already
- No new dependencies
- No network surface area — pure filesystem
- Naturally resilient: if the server is down, the signal file is just ignored; the message
  is already persisted in the DB and will appear on next page load
- Works even if the server restarts mid-signal (file persists until consumed)

**Cons:**
- Latency: `fs.watch` + 200ms debounce ≈ 200-400ms (within the 500ms budget)
- File I/O per broadcast (negligible for conversation message rates)
- Signal file can accumulate if server is down (need cleanup strategy)

### Option 2: Internal HTTP Endpoint

POST to `localhost:3847/internal/broadcast` with the broadcast payload.

**Pros:**
- Direct and synchronous — agent gets confirmation the broadcast was sent
- Easy to implement (one Express route)
- Can reuse existing localhost auth bypass

**Cons:**
- **New architectural pattern** — no internal HTTP endpoints exist today; adds a second
  cross-process mechanism alongside the established signal files
- Creates a network dependency: if the server is down or slow, the agent's `postMessage`
  flow blocks or needs timeout handling
- Requires error handling in the agent (connection refused, timeout, retry?)
- Port coupling — agents must know the server port (currently hardcoded but still a coupling)
- Security surface: even with localhost-only auth bypass, any local process can trigger
  arbitrary broadcasts. The signal file approach has the same exposure, but it's the
  existing, understood risk surface — adding HTTP doubles it

### Option 3: Shared IPC (Unix Socket / Message Queue)

Use a Unix domain socket or Node IPC for direct inter-process messaging.

**Pros:**
- Lowest latency (sub-millisecond)
- Clean separation from HTTP

**Cons:**
- **Significant new infrastructure** — nothing in HAN uses IPC today
- Requires connection management, reconnection logic, serialisation
- New dependency if using a message queue library
- Overkill for the message rates involved (a few messages per minute at most)
- Harder to debug than files or HTTP

## Decision: Signal File (Option 1)

**The signal file approach wins on every dimension that matters for HAN:**

1. **Consistency**: HAN already has 6+ signal types flowing through `~/.han/signals/`.
   Every agent already watches this directory. The pattern is proven and understood.

2. **Simplicity**: Write a file, watch a directory — no connection management, no ports,
   no retry logic. The `fs.watch` + consume pattern is already implemented 4 times in
   the codebase.

3. **Resilience**: The requirement explicitly states "missed broadcasts are acceptable,
   messages persist in DB." Signal files degrade gracefully — if the server misses one,
   the user sees the message on next interaction/refresh.

4. **No new dependencies**: Pure `fs` and `path` — already imported everywhere.

5. **Latency**: 200-400ms is well within the 500ms budget. Users won't perceive the
   difference vs. the HTTP approach.

## Implementation Plan

### Signal Format

**File path:** `~/.han/signals/ws-broadcast`

**Payload:**
```json
{
  "type": "conversation_message",
  "conversation_id": "conv-abc123",
  "discussion_type": "general",
  "message": {
    "id": "jim-human-abc123",
    "conversation_id": "conv-abc123",
    "role": "supervisor",
    "content": "Response text...",
    "created_at": "2026-03-17T10:00:00.000Z"
  },
  "timestamp": "2026-03-17T10:00:00.000Z"
}
```

This matches the canonical broadcast shape from `conversations.ts:293` — flat structure
with `type`, `conversation_id`, `discussion_type`, and `message` as a nested object.
The admin handler at `admin.ts:393` expects exactly this shape.

The `timestamp` field is metadata for the signal system (debugging, stale signal detection)
and is stripped before broadcasting.

### Step 1: Add Signal Writer to jim-human.ts and leo-human.ts

In both files, after the `postMessage()` DB insert, write a broadcast signal:

```typescript
// After postMessage() call
function writeBroadcastSignal(
    conversationId: string,
    discussionType: string,
    message: { id: string; conversation_id: string; role: string; content: string; created_at: string }
): void {
    try {
        const signal = JSON.stringify({
            type: 'conversation_message',
            conversation_id: conversationId,
            discussion_type: discussionType,
            message,
            timestamp: new Date().toISOString()
        });
        fs.writeFileSync(path.join(SIGNALS_DIR, 'ws-broadcast'), signal);
    } catch (err) {
        // Best effort — message is already in DB
        console.error('[Agent] Failed to write broadcast signal:', (err as Error).message);
    }
}
```

**Call sites** — every location where `postMessage()` is called. The agent should look up
the conversation's `discussion_type` from the DB before writing the signal:

```typescript
const msgId = postMessage(db, conversationId, content);
const conversation = db.prepare('SELECT discussion_type FROM conversations WHERE id = ?').get(conversationId) as any;
const discussionType = conversation?.discussion_type || 'general';

writeBroadcastSignal(conversationId, discussionType, {
    id: msgId,
    conversation_id: conversationId,
    role: 'supervisor',  // or 'leo' for leo-human.ts
    content,
    created_at: new Date().toISOString()
});
```

### Step 2: Add Signal Watcher to server.ts

In `server.ts`, add a watcher for the `ws-broadcast` signal file alongside the existing
`PENDING_DIR` watcher:

```typescript
// Watch for broadcast signals from external agents
const BROADCAST_SIGNAL = path.join(SIGNALS_DIR, 'ws-broadcast');
let broadcastDebounce: ReturnType<typeof setTimeout> | null = null;

fs.watch(SIGNALS_DIR, (eventType, filename) => {
    if (filename !== 'ws-broadcast') return;

    // Short debounce — multiple rapid writes should each be broadcast
    if (broadcastDebounce) clearTimeout(broadcastDebounce);
    broadcastDebounce = setTimeout(() => {
        try {
            const signalPath = path.join(SIGNALS_DIR, 'ws-broadcast');
            if (!fs.existsSync(signalPath)) return;

            const raw = fs.readFileSync(signalPath, 'utf-8');
            fs.unlinkSync(signalPath);  // Consume the signal

            const data = JSON.parse(raw);
            delete data.timestamp;  // Strip signal metadata

            broadcast(data);
            console.log(`[Server] Broadcast signal relayed: ${data.type} for ${data.conversation_id}`);
        } catch (err) {
            console.error('[Server] Failed to process broadcast signal:', (err as Error).message);
        }
    }, 100);  // 100ms debounce — fast enough for real-time, prevents double-fires
});
```

**Note:** The server already watches `SIGNALS_DIR` isn't set up in `server.ts` — it watches
`PENDING_DIR` for pending prompts. The signals directory watcher is a new addition to
`server.ts`, but it follows the identical `fs.watch` + debounce + consume pattern already
used for `PENDING_DIR`.

### Step 3: Ensure SIGNALS_DIR Exists in server.ts

Add to the server startup:
```typescript
const SIGNALS_DIR = path.join(HOME, '.han', 'signals');
if (!fs.existsSync(SIGNALS_DIR)) {
    fs.mkdirSync(SIGNALS_DIR, { recursive: true });
}
```

## Edge Cases

### Race: Two agents write simultaneously

If both jim-human and leo-human write `ws-broadcast` at the same instant, one write
overwrites the other. The overwritten message is **not lost** — it's in the DB and will
appear on next page load or refresh. This is acceptable per requirements ("missed broadcasts
are acceptable").

**Mitigation (if needed later):** Use unique filenames like `ws-broadcast-{timestamp}` and
have the server consume all `ws-broadcast-*` files. This adds complexity and isn't needed
at current message rates (a few per minute). Can be added if it becomes an issue.

### Server restart during signal

If the server restarts after the signal is written but before it's consumed, the signal
file persists on disk. On restart, the `fs.watch` won't fire for an existing file. The
message is still in the DB — the user sees it on page load.

**Mitigation:** On server startup, check for and consume any existing `ws-broadcast` file.
This is a one-line addition to the startup sequence.

```typescript
// On startup — consume any stale broadcast signal
try {
    const staleSignal = path.join(SIGNALS_DIR, 'ws-broadcast');
    if (fs.existsSync(staleSignal)) {
        fs.unlinkSync(staleSignal);
        console.log('[Server] Cleaned stale broadcast signal from previous run');
    }
} catch { /* best effort */ }
```

We don't broadcast it on startup because the clients will fetch fresh data anyway.

### Signal file left behind (server down for extended period)

If the server is down, signal files accumulate. On restart, we clean them (see above).
No risk of unbounded growth — each write overwrites the previous one, so at most one file
accumulates.

### fs.watch reliability on Linux

`fs.watch` uses `inotify` on Linux, which is reliable for single-directory watching. The
existing codebase already depends on this (4 agents use `fs.watch` on `~/.han/signals/`).
The 60-second polling fallback in jim-human.ts and leo-human.ts exists for their own wake
signals, not because `fs.watch` is unreliable — it's a safety net for edge cases like
inotify descriptor exhaustion.

The server doesn't need a polling fallback for broadcast signals because missed broadcasts
are acceptable — the data is always in the DB.

## Security Considerations

### Signal file permissions

The signals directory and files inherit the user's umask (typically 0644 for files, 0755
for directories). Since all agents run as the same Unix user (`darron`), this is
appropriate. No other users on the system can write to the signals directory.

**Risk:** A compromised local process running as `darron` could write arbitrary broadcast
payloads. This is the same risk surface as the existing signal files (which can wake
agents and trigger LLM calls). The broadcast signal is lower-risk because it only sends
data to connected WebSocket clients — it doesn't trigger any server-side actions.

### No external network exposure

Unlike the HTTP endpoint option, signal files have zero network surface area. There's no
port to scan, no endpoint to probe, no authentication to bypass.

## Broadcast Shape Consistency

**Current inconsistency to fix alongside this work:**

`supervisor-worker.ts:1407` currently broadcasts with a **nested** `data` wrapper that
`admin.ts:393` doesn't expect. The fix (part of the parent goal) is to make
`supervisor-worker.ts` use the same flat shape as `conversations.ts:293`:

```typescript
// Canonical shape (conversations.ts:293 — what admin.ts expects)
{
    type: 'conversation_message',
    conversation_id: string,
    discussion_type: string,
    message: { id, conversation_id, role, content, created_at }
}
```

The signal file approach naturally enforces this — the agent writes the canonical shape
into the signal file, and the server relays it verbatim. There's no second code path
that could drift.

## Files to Modify

| File | Change |
|------|--------|
| `src/server/jim-human.ts` | Add `writeBroadcastSignal()`, call after every `postMessage()` |
| `src/server/leo-human.ts` | Add `writeBroadcastSignal()`, call after every `postMessage()` |
| `src/server/server.ts` | Add `fs.watch` for `ws-broadcast` signal, startup cleanup |

**No new files** — the implementation adds ~30 lines to each agent and ~25 lines to the
server. No new dependencies.

## Testing

1. **Manual:** Post a message in a conversation via the admin UI. Verify the admin UI
   updates in real time (existing path via conversations.ts broadcast still works).

2. **Agent path:** Trigger jim-human or leo-human to respond to a conversation. Verify
   the admin UI updates without requiring a page refresh.

3. **Race condition:** Send two messages in rapid succession to different conversations
   handled by different agents. Verify at least one broadcast arrives (the other is
   acceptable to miss per requirements).

4. **Server restart:** Write a signal file manually, restart the server, verify the stale
   file is cleaned up and no crash occurs.
