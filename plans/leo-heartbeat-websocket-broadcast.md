# Leo Heartbeat — WebSocket Broadcast Fix

> **Problem:** Leo's heartbeat posts messages directly to the database without notifying the
> WebSocket layer. The React admin never learns about new messages from the heartbeat, so the
> UI doesn't update until the user refreshes.
>
> **Scope:** One function in one file. ~20 lines added.

---

## What Exists Today

### Leo/Human (working correctly)
`src/server/leo-human.ts` line 115 — `postMessage()` does three things:
1. INSERTs into `conversation_messages` (DB write)
2. Calls `notifyServer()` — HTTP POST to `/api/conversations/internal/broadcast` on port 3847
3. Calls `writeBroadcastSignal()` — writes JSON to `~/.han/signals/ws-broadcast`

Both #2 and #3 are belt-and-braces: the HTTP POST tells the main server process directly,
the signal file is caught by the server's `fs.watch` + polling fallback. Either one alone
would work. Together they ensure the React admin gets the WebSocket event.

### Jim/Human (working correctly)
`src/server/jim-human.ts` line 155 — `postMessage()` does the same three things.

### Leo Heartbeat (broken)
`src/server/leo-heartbeat.ts` line 933 — `postMessageToConversation()` does:
1. INSERTs into `conversation_messages`
2. Updates `conversations.updated_at`
3. **Nothing else.** No `notifyServer()`. No `writeBroadcastSignal()`. No WebSocket event.

Currently called from one place:
- Line 1464: posting philosophy responses to the Jim conversation thread

Any message Leo's heartbeat posts is invisible to the React admin until a manual refresh.

## The Fix

Add `notifyServer()` and `writeBroadcastSignal()` to `postMessageToConversation()` in
`leo-heartbeat.ts`, matching the exact pattern from `leo-human.ts`.

### Step 1: Check imports

Search for `import * as https` at the top of `leo-heartbeat.ts`. If missing, add:
```typescript
import * as https from 'https';
```

Also confirm `SIGNALS_DIR` is defined and points to `~/.han/signals/`.

### Step 2: Add `notifyServer` function

Place near the other utility functions (around line 933). Copy the pattern from
`leo-human.ts` lines 166-182:

```typescript
function notifyServer(conversationId: string, messageId: string, role: string, content: string, createdAt: string): void {
    const body = JSON.stringify({ conversation_id: conversationId, message_id: messageId, role, content, created_at: createdAt });
    const req = https.request({
        hostname: '127.0.0.1',
        port: 3847,
        path: '/api/conversations/internal/broadcast',
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) },
        rejectUnauthorized: false,
    }, (res) => {
        if (res.statusCode !== 200) console.log(`[Leo] Broadcast notify returned ${res.statusCode}`);
        res.resume();
    });
    req.on('error', (err) => console.log(`[Leo] Broadcast notify failed: ${err.message}`));
    req.end(body);
}
```

### Step 3: Add `writeBroadcastSignal` function

```typescript
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
        console.error('[Leo] Failed to write broadcast signal:', (err as Error).message);
    }
}
```

### Step 4: Update `postMessageToConversation`

**Current** (line 933):
```typescript
function postMessageToConversation(db: Database.Database, conversationId: string, content: string): void {
    const id = `leo-hb-${Date.now().toString(36)}`;
    db.prepare(`
        INSERT INTO conversation_messages (id, conversation_id, role, content, created_at)
        VALUES (?, ?, 'leo', ?, ?)
    `).run(id, conversationId, content, new Date().toISOString());

    db.prepare(`
        UPDATE conversations SET updated_at = datetime('now') WHERE id = ?
    `).run(conversationId);
}
```

**Updated:**
```typescript
function postMessageToConversation(db: Database.Database, conversationId: string, content: string): void {
    const id = `leo-hb-${Date.now().toString(36)}`;
    const now = new Date().toISOString();
    db.prepare(`
        INSERT INTO conversation_messages (id, conversation_id, role, content, created_at)
        VALUES (?, ?, 'leo', ?, ?)
    `).run(id, conversationId, content, now);

    db.prepare(`
        UPDATE conversations SET updated_at = ? WHERE id = ?
    `).run(now, conversationId);

    // Notify React admin via WebSocket (belt-and-braces: HTTP + signal file)
    notifyServer(conversationId, id, 'leo', content, now);

    try {
        const conversation = db.prepare('SELECT discussion_type FROM conversations WHERE id = ?').get(conversationId) as any;
        const discussionType = conversation?.discussion_type || 'general';
        writeBroadcastSignal(conversationId, discussionType, {
            id,
            conversation_id: conversationId,
            role: 'leo',
            content,
            created_at: now
        });
    } catch (err) {
        console.error('[Leo] Failed to write broadcast signal:', (err as Error).message);
    }
}
```

Key changes:
- Capture `now` once and reuse (consistent timestamp across DB write and broadcast)
- Use `now` in the UPDATE instead of `datetime('now')` (same value, now available for broadcast)
- Call `notifyServer()` — HTTP POST to main server
- Call `writeBroadcastSignal()` — signal file fallback

### Step 5: Build and test

```bash
cd ~/Projects/han && npm run build
```

Test: trigger a Leo philosophy beat (wait for the next heartbeat cycle, or post a message
to the Jim philosophy thread). Watch the browser Network/Console tab — you should see a
`conversation_message` WebSocket event arrive, and the React admin should update without
a manual refresh.

---

## What NOT to change

- **Leo/Human** (`leo-human.ts`) — already has both broadcast mechanisms
- **Jim/Human** (`jim-human.ts`) — already has both broadcast mechanisms
- **Server broadcast infrastructure** — `ws-broadcast` signal watcher, `/internal/broadcast`
  endpoint, and `broadcast()` in `ws.ts` all work correctly
- **React admin** — WebSocket subscription and store updates are correctly wired; it will
  auto-render as soon as it receives the event

## Verification

After the fix:
1. Leo heartbeat posts a philosophy response → React admin shows it immediately (no refresh)
2. Server log shows `[Server] Broadcast signal relayed: conversation_message for <id>`
3. No duplicate messages in the DB (the broadcast is notification-only, not a second insert)
