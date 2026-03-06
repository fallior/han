# Jemma Delivery API

The Jemma delivery routes handle Discord message routing from the Jemma Discord Gateway service to appropriate recipients (Jim, Leo, or Darron).

## Routes

### POST /api/jemma/deliver

Accepts classified Discord messages from Jemma service and routes to the appropriate recipient.

**Access**: Localhost only (127.0.0.1, ::1, or ::ffff:127.0.0.1)

**Request Body**:
```json
{
  "recipient": "jim|leo|darron",
  "message": "message text",
  "channel": "channel_name",
  "author": "user_name",
  "classification_confidence": 0.95,
  "conversation_id": "optional-conv-id"
}
```

**Response**:
```json
{
  "success": true,
  "recipient": "jim",
  "delivered": true,
  "message": "Routed to jim"
}
```

**Routing Logic**:

- **jim**:
  - Creates (or uses provided) conversation entry in DB with type='discord'
  - Inserts message as 'discord' role
  - Writes signal file: `~/.han/signals/jim-wake-discord-{timestamp}`
  - Signal contains: conversationId, author, channel, confidence, mentionedAt

- **leo**:
  - Writes signal file: `~/.han/signals/leo-wake-discord-{timestamp}`
  - Signal contains: author, channel, message preview (first 200 chars), confidence, mentionedAt

- **darron**:
  - Sends push notification via ntfy.sh (requires ntfy_topic in config.json)
  - Priority: high
  - Tags: jemma,discord

**WebSocket Broadcast** (all recipients):
Broadcasts message to all connected Admin UI clients:
```json
{
  "type": "jemma_delivery",
  "recipient": "jim|leo|darron",
  "channel": "channel_name",
  "author": "user_name",
  "message_preview": "first 100 chars",
  "classification_confidence": 0.95,
  "delivered": true,
  "timestamp": "2026-03-03T..."
}
```

**Error Cases**:
- `403 Forbidden`: Request not from localhost
- `400 Bad Request`: Missing required fields or invalid recipient
- `400 Bad Request`: classification_confidence not between 0-1
- `500 Internal Server Error`: Database or notification error

### GET /api/jemma/status

Returns the current health status of the Jemma service.

**Access**: All (no restrictions)

**Response** (success):
```json
{
  "success": true,
  "status": "connected|disconnected|error",
  "...": "... other health fields from jemma-health.json"
}
```

**Response** (no health file yet):
```json
{
  "success": true,
  "status": "unknown",
  "message": "Jemma has not reported health yet"
}
```

## Integration with Jemma Service

The `src/server/jemma.ts` main service:

1. Connects to Discord Gateway via WebSocket
2. Receives MESSAGE_CREATE events
3. Classifies incoming messages using Ollama (Gemma/Qwen)
4. Routes classified messages to `/api/jemma/deliver`
5. Writes health status to `~/.han/health/jemma-health.json`

## Testing

### Test jim routing:
```bash
curl -X POST http://localhost:3847/api/jemma/deliver \
  -H 'Content-Type: application/json' \
  -d '{
    "recipient": "jim",
    "message": "test message",
    "channel": "general",
    "author": "testuser",
    "classification_confidence": 0.95
  }'
```

### Test leo routing:
```bash
curl -X POST http://localhost:3847/api/jemma/deliver \
  -H 'Content-Type: application/json' \
  -d '{
    "recipient": "leo",
    "message": "test message",
    "channel": "general",
    "author": "testuser",
    "classification_confidence": 0.95
  }'
```

### Test darron routing:
```bash
curl -X POST http://localhost:3847/api/jemma/deliver \
  -H 'Content-Type: application/json' \
  -d '{
    "recipient": "darron",
    "message": "test message",
    "channel": "general",
    "author": "testuser",
    "classification_confidence": 0.95
  }'
```

### Check status:
```bash
curl http://localhost:3847/api/jemma/status
```

### Test localhost restriction (should fail):
```bash
curl -X POST http://192.168.1.x:3847/api/jemma/deliver \
  -H 'Content-Type: application/json' \
  -d '{
    "recipient": "jim",
    "message": "test",
    "channel": "test",
    "author": "test",
    "classification_confidence": 0.95
  }'
# Returns: 403 Forbidden - Jemma delivery is localhost-only
```

## File Locations

- Signal files: `~/.han/signals/`
  - `jim-wake-discord-{timestamp}` — JSON with conversation details
  - `leo-wake-discord-{timestamp}` — JSON with message preview

- Health status: `~/.han/health/jemma-health.json`
  - Updated by jemma service with connection status

## Environment & Config

Requires `~/.han/config.json` with:
```json
{
  "ntfy_topic": "your-ntfy-topic"
}
```

The ntfy topic is used for Darron notifications. If not configured, ntfy delivery is skipped gracefully (best effort).
