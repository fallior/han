# Distress Signals - Testing Guide

## Quick Start Testing

### 1. Create a Jim Distress Signal

```bash
cat > ~/.han/health/jim-distress.json <<'EOF'
{
  "timestamp": "2026-03-03T09:15:00Z",
  "reason": "Heap memory usage at 85% threshold",
  "details": {
    "heapUsed": "8.5GB",
    "heapLimit": "10GB",
    "gcPausesExceeding30ms": 12,
    "avgGcPause": "47ms"
  }
}
EOF
```

### 2. Create a Leo Distress Signal

```bash
cat > ~/.han/health/leo-distress.json <<'EOF'
{
  "timestamp": "2026-03-03T09:18:00Z",
  "reason": "Task processing latency spike (p95: 5000ms)",
  "details": {
    "avgLatency": "2500ms",
    "p95Latency": "5000ms",
    "p99Latency": "8500ms",
    "tasksInQueue": 47
  }
}
EOF
```

### 3. View the Health Endpoint

Navigate to the Supervisor module in the admin console and observe:

1. **Top of Health Card**: Two amber warning banners appear
   - "⚠ Jim Degraded" with reason and timestamp
   - "⚠ Leo Degraded" with reason and timestamp

2. **Status Cards**:
   - Both Jim and Leo show "Degraded" badge (amber color)
   - Visual prominence between green "ok" and red "down"

3. **Details Available**:
   - Reason for degradation displayed
   - Age of signal (e.g., "5 minutes ago", "Just now")
   - Complete details visible in browser console via API response

## Test Scenarios

### Scenario 1: Fresh Distress Signal

**Setup:**
```bash
# Create signal with current timestamp
jq -n --arg ts "$(date -u +%Y-%m-%dT%H:%M:%SZ)" \
  '{timestamp: $ts, reason: "New issue detected", details: {}}' > \
  ~/.han/health/jim-distress.json
```

**Expected:**
- Signal appears immediately in UI
- Age displays as "Just now"
- Warning banner is prominent

### Scenario 2: Aging Distress Signal

**Setup:**
```bash
# Create signal 30 minutes old
jq -n --arg ts "$(date -u -d '30 minutes ago' +%Y-%m-%dT%H:%M:%SZ)" \
  '{timestamp: $ts, reason: "Aging issue", details: {}}' > \
  ~/.han/health/jim-distress.json
```

**Expected:**
- Signal still visible in UI
- Age displays as "30 minutes ago"
- Banner still shows (signal is <1 hour old)

### Scenario 3: Stale Distress Signal (>1 hour)

**Setup:**
```bash
# Create signal 90 minutes old
jq -n --arg ts "$(date -u -d '90 minutes ago' +%Y-%m-%dT%H:%M:%SZ)" \
  '{timestamp: $ts, reason: "Very old issue", details: {}}' > \
  ~/.han/health/jim-distress.json
```

**Expected:**
- Signal is NOT displayed in UI
- Status card shows normal health status (not degraded)
- No warning banner appears

### Scenario 4: Signal Cleared

**Setup:**
```bash
# Remove the distress signal file
rm ~/.han/health/jim-distress.json
```

**Expected:**
- Warning banner disappears
- Status returns to normal (no "Degraded" badge)
- UI updates immediately on next health refresh

### Scenario 5: Both Agents Degraded

**Setup:**
```bash
# Create distress for both agents
NOW=$(date -u +%Y-%m-%dT%H:%M:%SZ)
jq -n --arg ts "$NOW" \
  '{timestamp: $ts, reason: "Jim issue", details: {}}' > \
  ~/.han/health/jim-distress.json
jq -n --arg ts "$NOW" \
  '{timestamp: $ts, reason: "Leo issue", details: {}}' > \
  ~/.han/health/leo-distress.json
```

**Expected:**
- Two warning banners appear (one for each agent)
- Both status cards show "Degraded" badge
- Each banner shows its respective reason

## API Response Testing

### Check Raw Response

```bash
curl -s http://localhost:3847/api/supervisor/health | jq '.distress'
```

**Expected response (if signals present):**
```json
{
  "jim": {
    "timestamp": "2026-03-03T09:15:00Z",
    "ageMinutes": 5,
    "reason": "Heap memory usage at 85% threshold",
    "details": {...}
  },
  "leo": {
    "timestamp": "2026-03-03T09:18:00Z",
    "ageMinutes": 2,
    "reason": "Task processing latency spike",
    "details": {...}
  }
}
```

**Expected response (if no signals):**
```json
null
```

## Signal File Format

Distress signals should be valid JSON:

```json
{
  "timestamp": "ISO-8601 UTC timestamp",
  "reason": "Human-readable reason (required)",
  "details": {
    "key1": "value1",
    "key2": 123,
    "nested": { "data": "here" }
  }
}
```

**Requirements:**
- `timestamp` must be valid ISO-8601 UTC format
- `reason` should be concise (fits in UI banner)
- `details` can contain any metadata for diagnostics
- File must be valid JSON (syntax errors are silently ignored)

## Monitoring in Real Time

1. Open admin console, go to Supervisor module
2. Create a distress signal
3. Observe warning banner appears
4. Monitor Health panel as signal ages
5. Wait for >1 hour (or modify timestamp) to see auto-expiry

## Automated Testing

See `test-distress-endpoint.ts` (removed after use) for test logic:

```typescript
// Simulates the endpoint's distress signal handling
const distressAgeMs = now.getTime() - distressTimestamp.getTime();
if (distressAgeMs < ONE_HOUR_MS) {
    // Include signal in response
}
```

## Colors & Styling Reference

- **Alert banner**: Amber background (`var(--amber)15`)
- **Left border**: Amber solid (`var(--amber)`)
- **Text**: Amber heading, dim timestamp
- **Badge text**: "Degraded" (uppercase, 12px)
- **Emoji**: Warning ⚠ (18px)

## Troubleshooting

### Signal not appearing in UI
- Check file exists: `ls -la ~/.han/health/*-distress.json`
- Verify valid JSON: `jq . ~/.han/health/jim-distress.json`
- Check timestamp is recent: `date -u` vs file's `timestamp` field
- Refresh admin page (F5)

### Age displays incorrectly
- Verify `timestamp` field uses UTC (`Z` suffix)
- Check server time is correct: `date -u`
- Signal must be <1 hour old to display

### Signal won't clear
- Use `rm ~/.han/health/leo-distress.json` to delete
- Or create new signal with current timestamp to override
- Don't rely on `cron` to delete — app handles auto-expiry

## Future Testing

Once integrated with signal generation (Jim/Leo agents):

```bash
# Trigger Jim distress via monitoring
# (when Jim detects memory pressure)

# Trigger Leo distress via monitoring
# (when Leo detects high latency)

# Verify auto-recovery clears signals
# (when thresholds return to normal)
```

## Performance Considerations

- Distress signal read is fast (small JSON files, <1KB)
- Check happens on every `/health` endpoint call (~100ms interval)
- No performance impact even with multiple agents degraded
- Stale signals are filtered server-side (not sent to client)
