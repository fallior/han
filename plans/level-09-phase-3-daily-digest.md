# Level 9 Phase 3: Daily Digest — Implementation Spec

> Status: Complete

## Context

The automator runs tasks overnight but there's no morning briefing. Phase 3 adds digest generation that aggregates task activity across all projects, a scheduler that generates at a configured hour, push notification delivery via ntfy.sh, and API endpoints for retrieval and manual generation.

## What Was Built

- **`digests` table** — Stores generated digests with id, generated_at, period_start, period_end, digest_text (markdown), digest_json (structured), task_count, total_cost, viewed_at
- **`digestStmts`** — Prepared statements: insert, getLatest, getById, list, markViewed
- **`generateDailyDigest(since)`** — Aggregates completed/failed tasks across all projects since a timestamp, builds one-line summary + per-project breakdown in both markdown and JSON, stores in digests table, broadcasts `digest_ready` via WebSocket. Returns null if no activity.
- **`loadConfig()`** — Reads `~/.claude-remote/config.json`, returns empty object on failure
- **`sendDigestPush(summary)`** — Sends digest summary via ntfy.sh using curl (reads `ntfy_topic` from config)
- **Digest scheduler** — Hourly `setInterval` checks against configured hour (default 7:00), generates for last 24 hours, skips if already generated today or no activity. Also checks on startup after 5s delay.
- **API endpoints**:
  - `GET /api/digest/latest` — Returns latest digest, marks as viewed
  - `POST /api/digest/generate` — Force generation for last 24h (or `?since=` param)
  - `GET /api/digest/history` — List of past digests (last 30)
- **WebSocket broadcast** — `digest_ready` message with digestId, task_count, total_cost

## Key Files

| File | Role |
|------|------|
| `src/server/server.js` | All implementation |

## Key Decisions

- Digest queries `tasks` table (not `project_memory`) for accurate task-level detail including commits and cost
- One-line summary format matches ROADMAP example: "Since {time}: {N} tasks completed across {M} projects (${cost}). {F} failures awaiting review."
- Push notification sends only the first line (summary) to keep notifications concise
- Scheduler uses local date components (not `toISOString()`) to avoid UTC date boundary issues
- `loadConfig()` is a standalone function (not cached) so config changes take effect without restart
- Startup check after 5s delay ensures a missed overnight digest is caught on server restart

## Verification

1. `POST /api/digest/generate` — verify digest generated with cross-project summary
2. `GET /api/digest/latest` — verify returns structured digest with text + JSON
3. `GET /api/digest/history` — verify list of past digests
4. Check ntfy push received on phone (if tasks were completed in last 24h)
5. Verify scheduler runs at configured hour and skips when no activity

## Drift Notes

None.
