# Distress Signals Implementation

## Summary

Added comprehensive distress signal support to the Robin Hood health monitoring system. Distress signals provide granular visibility into agent degradation scenarios that fall between "ok" and "down" states.

## Changes

### Backend (src/server/routes/supervisor.ts)

**Endpoint: `GET /api/supervisor/health`**

Extended response to include distress signals:

```typescript
{
  "success": true,
  "jim": { /* existing health data */ },
  "leo": { /* existing health data */ },
  "distress": {
    "jim": {
      "timestamp": "2026-03-03T09:15:00Z",
      "ageMinutes": 5,
      "reason": "Memory usage exceeding 85% threshold",
      "details": { /* structured metadata */ }
    },
    "leo": { /* same structure if degraded */ }
  } | null,  // null if no active distress signals
  "resurrections": [...],
  "systemUptimeMinutes": 42
}
```

**Implementation Details:**

- Reads `~/.claude-remote/health/jim-distress.json` and `leo-distress.json`
- Signals older than 1 hour are automatically expired (not returned)
- Age is calculated in minutes from signal timestamp to current time
- Returns `null` for distress field if no active signals exist
- Graceful fallback if files don't exist or parsing fails

### Frontend (src/ui/admin.ts)

**Health Panel Enhancements:**

1. **New status state**: `'distressed'` added to status badges
   - Displays as amber/orange color (between green "ok" and red "down")
   - Badge text reads "Degraded"

2. **Distress alert banners** (appear above status cards if signals present):
   ```
   ⚠ Jim Degraded
   Memory usage exceeding 85% threshold
   5 minutes ago
   ```

3. **Integrated status display**:
   - Status card shows "Degraded" badge if agent has active distress signal
   - Distress state takes visual precedence over standard health status
   - Both status and distress reason visible to user

4. **Helper functions**:
   - `formatDistressAge(minutes)`: Human-readable age formatting
     - "Just now" (< 1 min)
     - "5 minutes ago"
     - "2h 15m ago"
   - Updated `getStatusColor()` to handle `'distressed'` state
   - Updated `getStatusBadge()` to include distress label

## Acceptance Criteria - Status

✅ **API endpoint includes distress data**
- Backend reads distress signal files
- Response includes jim/leo distress objects with timestamp, age, reason, details

✅ **Stale distress signals (>1hr old) are ignored**
- Signals are checked against ONE_HOUR_MS threshold (3,600,000ms)
- Expired signals not returned in distress field

✅ **UI shows warning banner when distress detected**
- Banner displays before status cards
- Uses ⚠ emoji and amber background for visibility
- Shows reason and age of signal

✅ **Distress state visually distinct**
- Green background (ok) → Amber background (distressed) → Red background (down)
- Three-state visual hierarchy with clear separation

✅ **Real-time updates via WebSocket**
- Health endpoint called by supervisor module
- Updates reflect current distress state on each refresh

## Testing

Verified with test script:
- ✅ Signals <1 hour old are included
- ✅ Signals >1 hour old are ignored
- ✅ Response format is correct
- ✅ Age calculation works properly
- ✅ Graceful handling of missing files

## Signal Format

Distress signal files should be JSON with this structure:

```json
{
  "timestamp": "2026-03-03T09:15:00Z",
  "reason": "Human-readable degradation reason",
  "details": {
    "optional": "structured metadata",
    "for": "diagnostic purposes"
  }
}
```

Examples:
- `jim-distress.json`: Supervisor memory/performance issues
- `leo-distress.json`: Session agent latency/failure issues

## Signal Lifecycle

1. **Creation**: Agent writes distress signal file (when threshold exceeded)
2. **Detection**: Health endpoint reads file, calculates age
3. **Display**: UI shows alert banner if signal <1 hour old
4. **Expiration**: Signals automatically ignored after 1 hour
5. **Clearing**: Agent deletes file when normal operation resumes

## Colors Used

- **Green** (`var(--green)`): Status = 'ok'
- **Amber** (`var(--amber)`): Status = 'stale' OR 'distressed'
- **Red** (`var(--red)`): Status = 'down'

Alert banners use amber background at 15% opacity with left border accent.

## Integration Points

- Supervisor module fetches health data on each cycle
- WebSocket broadcasts health updates to all connected clients
- Dashboard displays distress state in real-time
- Alerts can trigger notification escalation (future enhancement)

## Future Enhancements

- Push notifications when distress signal is created
- History tracking of distress events
- Auto-recovery suggestions based on distress reason
- Distress signal aggregation across multiple agents
- Custom thresholds per distress type
